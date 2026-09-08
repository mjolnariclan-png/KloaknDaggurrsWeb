const fs = require('fs');
const path = require('path');
const { v2: cloudinary } = require('cloudinary');

// Cloudinary Configuration
cloudinary.config({
    cloud_name: 'sywzs1w9',
    api_key: '387367841542543',
    api_secret: 'Ths41qxona37vsd6-VC6meebtTk'
});

async function uploadCardImages() {
    const setsPath = 'B:\\Sets';
    
    if (!fs.existsSync(setsPath)) {
        console.error('Sets directory not found at B:\\Sets');
        return;
    }

    const sets = fs.readdirSync(setsPath).filter(dir => {
        const dirPath = path.join(setsPath, dir);
        return fs.statSync(dirPath).isDirectory();
    });

    console.log(`Found ${sets.length} card sets to process`);
    
    // First, delete all existing assets in tcg-cards folder
    console.log('Cleaning up existing Cloudinary assets...');
    await cleanupCloudinaryAssets();
    
    let totalUploaded = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const setName of sets) {
        console.log(`\nProcessing ${setName}...`);
        
        // Walk through all subdirectories to find images
        const setImagePath = path.join(setsPath, setName);
        const result = await uploadImagesFromDirectory(setImagePath, setName);
        totalUploaded += result.uploaded;
        totalSkipped += result.skipped;
        totalErrors += result.errors;
    }

    console.log(`\n✅ Upload complete!`);
    console.log(`Total uploaded: ${totalUploaded}`);
    console.log(`Total skipped: ${totalSkipped}`);
    console.log(`Total errors: ${totalErrors}`);
}

// Clean up existing Cloudinary assets before uploading
async function cleanupCloudinaryAssets() {
    try {
        let totalDeleted = 0;
        let nextCursor = null;
        
        do {
            // Get all resources in the tcg-cards folder (with pagination)
            const resources = await cloudinary.api.resources({
                type: 'upload',
                prefix: 'tcg-cards',
                resource_type: 'image',
                max_results: 500,
                next_cursor: nextCursor
            });
            
            if (resources.resources && resources.resources.length > 0) {
                const publicIds = resources.resources.map(r => r.public_id);
                
                // Delete existing assets in batches
                if (publicIds.length > 0) {
                    const deleteResult = await cloudinary.api.delete_resources(publicIds, {
                        resource_type: 'image'
                    });
                    
                    const deletedCount = deleteResult.deleted?.deleted?.length || publicIds.length;
                    totalDeleted += deletedCount;
                    console.log(`🗑️  Deleted ${deletedCount} assets (batch)`);
                }
            }
            
            nextCursor = resources.next_cursor;
        } while (nextCursor);
        
        console.log(`✅ Deleted ${totalDeleted} existing assets from Cloudinary`);
    } catch (error) {
        if (error.http_code !== 404) {
            console.log(`⚠️  Warning: Could not clean up existing assets: ${error.message}`);
        } else {
            console.log('✅ No existing assets to clean up');
        }
    }
}

async function uploadImagesFromDirectory(dirPath, setPrefix) {
    const items = fs.readdirSync(dirPath);
    let uploaded = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stat = fs.statSync(itemPath);
        
        if (stat.isDirectory()) {
            // Recursively process subdirectories
            const result = await uploadImagesFromDirectory(itemPath, setPrefix);
            uploaded += result.uploaded;
            skipped += result.skipped;
            errors += result.errors;
        } else if (stat.isFile() && isImageFile(item)) {
            // Upload image file
            const result = await uploadSingleImage(itemPath, setPrefix);
            if (result === 'uploaded') uploaded++;
            else if (result === 'skipped') skipped++;
            else errors++;
        }
    }
    
    return { uploaded, skipped, errors };
}

function isImageFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);
}

async function uploadSingleImage(imagePath, setPrefix) {
    try {
        // Convert local path to organized cloudinary folder structure
        const relativePath = path.relative('B:\\Sets', imagePath);
        
        // Create organized folder structure: tcg-cards/{Set Name}/{Card Type}/{Vigor Type}/{filename}
        const pathParts = relativePath.split(path.sep);
        const fileName = pathParts[pathParts.length - 1]; // Get filename
        const folderStructure = pathParts.slice(0, -1).join('/'); // Remove filename, keep folders
        
        // Create nested folder path for Cloudinary
        const fullFolderPath = `tcg-cards/${folderStructure}`;
        const publicId = fileName.replace(/\.[^/.]+$/, '');
        
        // Upload with organized folder structure
        const result = await cloudinary.uploader.upload(imagePath, {
            public_id: publicId,
            folder: fullFolderPath,
            resource_type: 'image',
            overwrite: true // Overwrite if exists (clean update)
        });
        
        console.log(`✅ Uploaded: ${relativePath} -> ${result.secure_url}`);
        return 'uploaded';
    } catch (error) {
        console.error(`❌ Error uploading ${imagePath}:`, error.message);
        return 'error';
    }
}

uploadCardImages();