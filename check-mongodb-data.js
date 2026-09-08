const { MongoClient } = require('mongodb');

// MongoDB Connection
const MONGODB_URI = 'mongodb+srv://mjolnariclan17:JuPiTeR2015!@tcg-game-db.ak26dwh.mongodb.net/?appName=tcg-game-db';
const DB_NAME = 'tcg-game-db';

async function checkMongoDBData() {
    let client;
    try {
        console.log('Connecting to MongoDB Atlas...');
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('Connected to MongoDB Atlas');

        const db = client.db(DB_NAME);
        const setsCollection = db.collection('card_sets');
        
        // Check First Light set
        const set = await setsCollection.findOne({ set_name: 'First Light' });
        
        if (set) {
            console.log(`\nChecking data for ${set.set_name}...`);
            
            // Get the cards collection for this set
            const cardsCollection = db.collection(`cards_${set.set_name.replace(/\s+/g, '_')}`);
            
            // Check both Vigor and Creature cards
            const vigorCard = await cardsCollection.findOne({ type: 'Vigor' });
            const creatureCard = await cardsCollection.findOne({ type: 'Creature' });
            
            console.log(`\nVigor Card: ${vigorCard.name}`);
            console.log(`  type: ${vigorCard.type}`);
            console.log(`  ap: ${vigorCard.ap}`);
            console.log(`  dp: ${vigorCard.dp}`);
            console.log(`  vigor: ${vigorCard.vigor}`);
            console.log(`  standard_path: ${vigorCard.standard_path}`);
            console.log(`  All fields:`, Object.keys(vigorCard));
            
            console.log(`\nCreature Card: ${creatureCard.name}`);
            console.log(`  type: ${creatureCard.type}`);
            console.log(`  ap: ${creatureCard.ap}`);
            console.log(`  dp: ${creatureCard.dp}`);
            console.log(`  vigor: ${creatureCard.vigor}`);
            console.log(`  attacks: ${creatureCard.attacks ? creatureCard.attacks.length : 'none'}`);
            console.log(`  standard_path: ${creatureCard.standard_path}`);
            console.log(`  All fields:`, Object.keys(creatureCard));
        }
        
    } catch (error) {
        console.error('Error checking MongoDB data:', error);
    } finally {
        if (client) {
            await client.close();
            console.log('\nMongoDB connection closed');
        }
    }
}

checkMongoDBData();