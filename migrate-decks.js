const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://mjolnariclan17:JuPiTeR2015!@tcg-game-db.ak26dwh.mongodb.net/?appName=tcg-game-db&retryWrites=true&w=majority&tls=true&tlsAllowInvalidCertificates=true&serverSelectionTimeoutMS=5000';
const DB_NAME = 'tcg-game-db';

async function migrateDecks() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('Connected to MongoDB Atlas');
    const db = client.db(DB_NAME);

    const prebuiltDecks = db.collection('prebuilt_decks');
    const decksDir = path.join(__dirname, 'decks');

    if (!fs.existsSync(decksDir)) {
        console.log('Decks directory not found');
        await client.close();
        return;
    }

    const deckFiles = fs.readdirSync(decksDir).filter(file => file.endsWith('.json'));
    console.log(`Found ${deckFiles.length} deck files`);

    for (const file of deckFiles) {
        try {
            const deckPath = path.join(decksDir, file);
            const deckData = JSON.parse(fs.readFileSync(deckPath, 'utf8'));

            await prebuiltDecks.updateOne(
                { deck_name: deckData.deck_name },
                { $set: deckData },
                { upsert: true }
            );

            console.log(`Migrated: ${deckData.deck_name}`);
        } catch (error) {
            console.error(`Error migrating ${file}:`, error);
        }
    }

    console.log('\n=== Deck Migration Complete ===');
    await client.close();
}

migrateDecks().catch(console.error);