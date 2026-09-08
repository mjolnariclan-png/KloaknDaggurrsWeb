const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

// MongoDB Connection
const MONGODB_URI = 'mongodb+srv://mjolnariclan17:JuPiTeR2015!@tcg-game-db.ak26dwh.mongodb.net/?appName=tcg-game-db';
const DB_NAME = 'tcg-game-db';

async function uploadManifests() {
    let client;
    try {
        console.log('Connecting to MongoDB Atlas...');
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('Connected to MongoDB Atlas');

        const db = client.db(DB_NAME);
        const setsPath = 'B:\\Sets';

        if (!fs.existsSync(setsPath)) {
            console.error('Sets directory not found at B:\\Sets');
            return;
        }

        const sets = fs.readdirSync(setsPath).filter(dir => {
            const dirPath = path.join(setsPath, dir);
            return fs.statSync(dirPath).isDirectory();
        });

        console.log(`Found ${sets.length} card sets to upload`);

        for (const setName of sets) {
            const manifestPath = path.join(setsPath, setName, `${setName}_manifest.json`);
            
            if (!fs.existsSync(manifestPath)) {
                console.log(`No manifest found for ${setName}, skipping...`);
                continue;
            }

            try {
                const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                console.log(`Processing ${setName}: ${manifestData.cards.length} cards`);

                // Upload card set metadata
                const setsCollection = db.collection('card_sets');
                await setsCollection.updateOne(
                    { set_name: setName },
                    {
                        $set: {
                            set_name: manifestData.set_name,
                            base_total: manifestData.base_total,
                            actual_total: manifestData.actual_total,
                            main_primordial_vigor: manifestData.main_primordial_vigor,
                            type_distribution: manifestData.type_distribution,
                            rarity_distribution: manifestData.rarity_distribution,
                            vigor_distribution: manifestData.vigor_distribution,
                            text_overlay: manifestData.text_overlay
                        }
                    },
                    { upsert: true }
                );

                // Upload individual cards
                const cardsCollection = db.collection(`cards_${setName.replace(/\s+/g, '_')}`);
                
                // Clear existing cards for this set
                await cardsCollection.deleteMany({});
                
                // Insert all cards
                if (manifestData.cards && manifestData.cards.length > 0) {
                    await cardsCollection.insertMany(manifestData.cards);
                    console.log(`✅ Uploaded ${manifestData.cards.length} cards for ${setName}`);
                }

            } catch (error) {
                console.error(`Error processing ${setName}:`, error.message);
            }
        }

        console.log('\n✅ Upload complete!');
        console.log('Card sets uploaded to MongoDB Atlas');
        
    } catch (error) {
        console.error('Error uploading manifests:', error);
    } finally {
        if (client) {
            await client.close();
            console.log('MongoDB connection closed');
        }
    }
}

uploadManifests();