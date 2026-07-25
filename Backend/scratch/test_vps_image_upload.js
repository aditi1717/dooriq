import { processAndSaveImage, getUploadStorageDir, deleteImageFile } from '../src/services/imageStorage.service.js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

async function testImageStorage() {
    console.log('--- Testing VPS Image Storage SOP ---');
    console.log('Upload Storage Dir:', getUploadStorageDir());

    // Create a 100x100 test PNG image buffer using Sharp
    const testBuffer = await sharp({
        create: {
            width: 100,
            height: 100,
            channels: 4,
            background: { r: 255, g: 0, b: 0, alpha: 1 }
        }
    })
    .png()
    .toBuffer();

    // Process and save
    const relativeUrl = await processAndSaveImage(testBuffer);
    console.log('Saved Image Path:', relativeUrl);

    // Verify file exists on disk
    const filename = path.basename(relativeUrl);
    const fullDiskPath = path.join(getUploadStorageDir(), filename);
    const exists = fs.existsSync(fullDiskPath);
    console.log('Disk File Exists:', exists);

    if (!exists) {
        throw new Error('Test failed: file was not saved on disk!');
    }

    // Verify format is WebP
    const metadata = await sharp(fullDiskPath).metadata();
    console.log('Image Format:', metadata.format);
    console.log('Image Width x Height:', `${metadata.width}x${metadata.height}`);

    if (metadata.format !== 'webp') {
        throw new Error(`Test failed: expected webp format but got ${metadata.format}`);
    }

    // Cleanup test file
    await deleteImageFile(relativeUrl);
    console.log('Cleaned up test file:', !fs.existsSync(fullDiskPath));
    console.log('✅ VPS Image Storage Test Passed Successfully!');
}

testImageStorage().catch((err) => {
    console.error('❌ Test Failed:', err);
    process.exit(1);
});
