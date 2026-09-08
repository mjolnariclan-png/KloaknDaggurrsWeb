const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://mjolnariclan17:JuPiTeR2015!@tcg-game-db.ak26dwh.mongodb.net/?appName=tcg-game-db&retryWrites=true&w=majority&tls=true&tlsAllowInvalidCertificates=true&serverSelectionTimeoutMS=5000';
const DB_NAME = 'tcg-game-db';

async function migrate() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('Connected to MongoDB Atlas');
    const db = client.db(DB_NAME);

    // Step 1: Add stable _id to all card documents (set_name_card_name format)
    console.log('\n=== Step 1: Adding stable _id to card documents ===');
    const setsCollection = db.collection('card_sets');
    const sets = await setsCollection.find({}).toArray();

    for (const set of sets) {
        const cardsCollection = db.collection(`cards_${set.set_name.replace(/\s+/g, '_')}`);
        const cards = await cardsCollection.find({}).toArray();
        
        let updatedCount = 0;
        for (const card of cards) {
            const stableId = `${set.set_name}_${card.name}`.replace(/\s+/g, '_');
            
            // Check if card already has a stable _id
            if (!card._id || card._id.toString().length > 24) {
                await cardsCollection.updateOne(
                    { name: card.name },
                    { $set: { _id: stableId } }
                );
                updatedCount++;
            }
        }
        console.log(`Updated ${updatedCount} cards in ${set.set_name}`);
    }

    // Step 2: Create prebuilt_decks collection
    console.log('\n=== Step 2: Creating prebuilt_decks collection ===');
    const prebuiltDecks = db.collection('prebuilt_decks');
    await prebuiltDecks.createIndex({ deck_name: 1 }, { unique: true });
    await prebuiltDecks.createIndex({ set: 1 });
    console.log('Created prebuilt_decks collection with indexes');

    // Step 3: Create player_decks collection
    console.log('\n=== Step 3: Creating player_decks collection ===');
    const playerDecks = db.collection('player_decks');
    await playerDecks.createIndex({ user_id: 1 });
    await playerDecks.createIndex({ user_id: 1, is_custom: 1 });
    await playerDecks.createIndex({ created_at: -1 });
    console.log('Created player_decks collection with indexes');

    // Step 4: Create player_progression collection
    console.log('\n=== Step 4: Creating player_progression collection ===');
    const playerProgression = db.collection('player_progression');
    await playerProgression.createIndex({ user_id: 1 }, { unique: true });
    await playerProgression.createIndex({ level: 1, prestige: 1 });
    console.log('Created player_progression collection with indexes');

    // Step 5: Create queue_penalties collection
    console.log('\n=== Step 5: Creating queue_penalties collection ===');
    const queuePenalties = db.collection('queue_penalties');
    await queuePenalties.createIndex({ user_id: 1, date: 1 });
    console.log('Created queue_penalties collection with indexes');

    // Step 6: Create matchmaking_queue collection
    console.log('\n=== Step 6: Creating matchmaking_queue collection ===');
    const matchmakingQueue = db.collection('matchmaking_queue');
    await matchmakingQueue.createIndex({ user_id: 1 }, { unique: true });
    await matchmakingQueue.createIndex({ status: 1, queue_time: 1 });
    console.log('Created matchmaking_queue collection with indexes');

    // Step 7: Remove old players collection (progression moved to player_progression)
    console.log('\n=== Step 7: Removing old players collection ===');
    try {
        await db.collection('players').drop();
        console.log('Dropped old players collection');
    } catch (error) {
        console.log('Old players collection not found or already dropped');
    }

    console.log('\n=== Migration Complete ===');
    await client.close();
}

migrate().catch(console.error);