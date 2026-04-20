import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import crypto from 'crypto';

export default function getRemoteAssets(options = {}) {
  const { url = '', imageDir = './images' } = options;
  const urls = Array.isArray(url) ? url : [url].filter(Boolean);

  return {
    name: 'astro-cms-image-plugin',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const outputDir = typeof dir === 'string' ? dir : fileURLToPath(dir);
        const imagesPath = path.join(outputDir, imageDir);
        const downloadedImages = new Map();

        console.log(`🖼️  Downloading images from ${urls.length} source${urls.length > 1 ? 's' : ''}...`);

        // Create images directory if it doesn't exist
        await ensureDirectory(imagesPath);

        // Process HTML files
        await processHtmlFiles(outputDir, urls, imagesPath, downloadedImages);

        console.log(`✅ Downloaded ${downloadedImages.size} images to ${imageDir}`);
      },
    },
  };
}

// Ensure directory exists
async function ensureDirectory(dirPath) {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
  } catch (error) {
    console.error(`Failed to create directory ${dirPath}:`, error);
  }
}

// Process all HTML files in the output directory
async function processHtmlFiles(
  outputDir,
  targetUrls,
  imagesPath,
  downloadedImages,
) {
  try {
    const files = await getAllHtmlFiles(outputDir);

    for (const file of files) {
      await processHtmlFile(file, targetUrls, imagesPath, downloadedImages);
    }
  } catch (error) {
    console.error('Error processing HTML files:', error);
  }
}

// Get all HTML files recursively
async function getAllHtmlFiles(dir, files = []) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await getAllHtmlFiles(fullPath, files);
    } else if (
      entry.isFile() &&
      path.extname(entry.name).toLowerCase() === '.html'
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

// Process a single HTML file
async function processHtmlFile(
  filePath,
  targetUrls,
  imagesPath,
  downloadedImages,
) {
  try {
    let content = await fs.promises.readFile(filePath, 'utf8');
    let modified = false;

    // Process each target URL
    for (const targetUrl of targetUrls) {
      // Regular expression to find img and source tags with the target URL
      const imgRegex = new RegExp(
        `(<(?:img|source)[^>]*(?:src|srcset)=")(${targetUrl}[^"]+)([^>]*>)`,
        'gi',
      );

      // Process each match
      const matches = [...content.matchAll(imgRegex)];

      for (const match of matches) {
        const fullMatch = match[0];
        const prefix = match[1];
        const imageUrl = match[2];
        const suffix = match[3];

        // Download image if not already downloaded
        let localPath;
        if (downloadedImages.has(imageUrl)) {
          localPath = downloadedImages.get(imageUrl);
        } else {
          localPath = await downloadImage(imageUrl, imagesPath);
          if (localPath) {
            downloadedImages.set(imageUrl, localPath);
          }
        }

        // Replace URL with local path
        if (localPath) {
          const relativePath = path.relative(path.dirname(filePath), localPath);
          const newTag = `${prefix}${relativePath}${suffix}`;
          content = content.replace(fullMatch, newTag);
          modified = true;
        }
      }

      // Also handle srcset attributes
      const srcsetRegex = new RegExp(
        `(srcset="[^"]*)(${targetUrl}[^\s",]+)`,
        'gi',
      );
      const srcsetMatches = [...content.matchAll(srcsetRegex)];

      for (const match of srcsetMatches) {
        const imageUrl = match[2];

        let localPath;
        if (downloadedImages.has(imageUrl)) {
          localPath = downloadedImages.get(imageUrl);
        } else {
          localPath = await downloadImage(imageUrl, imagesPath);
          if (localPath) {
            downloadedImages.set(imageUrl, localPath);
          }
        }

        if (localPath) {
          const relativePath = path.relative(path.dirname(filePath), localPath);
          content = content.replace(imageUrl, relativePath);
          modified = true;
        }
      }
    }

    // Write modified content back to file
    if (modified) {
      await fs.promises.writeFile(filePath, content, 'utf8');
      // HTML file updated
    }
  } catch (error) {
    console.error(`Error processing HTML file ${filePath}:`, error);
  }
}

// Download image from URL with timeout and proper URL encoding
async function downloadImage(imageUrl, imagesPath) {
  try {
    // Decode HTML entities (&amp; → &) that Astro encodes in attribute values
    const cleanUrl = imageUrl.replace(/&amp;/g, '&');

    // Properly encode the URL to handle special characters
    const encodedUrl = encodeURI(decodeURI(cleanUrl));

    // Generate unique filename using URL hash
    const urlHash = crypto.createHash('md5').update(cleanUrl).digest('hex');

    // Extract original extension from URL if possible
    const urlParts = new URL(encodedUrl);
    const pathParts = urlParts.pathname.split('/');
    const originalFilename = pathParts[pathParts.length - 1];
    let extension = '.jpg'; // Default extension

    if (originalFilename) {
      const decodedFilename = decodeURIComponent(originalFilename);
      const ext = path.extname(decodedFilename).toLowerCase();
      if (
        ext &&
        ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'].includes(ext)
      ) {
        extension = ext;
      }
    }

    // fm query parameter overrides extension (CDN format conversion e.g. fm=avif, fm=webp)
    const fmExtMap = { avif: '.avif', webp: '.webp', jpg: '.jpg', jpeg: '.jpg', png: '.png', gif: '.gif' };
    const fmParam = urlParts.searchParams.get('fm');
    if (fmParam && fmExtMap[fmParam]) {
      extension = fmExtMap[fmParam];
    }

    // Create unique filename with hash
    const filename = `cms-image-${urlHash}${extension}`;

    const localPath = path.join(imagesPath, 'cms', filename);

    // Create subdirectory for CMS images
    await ensureDirectory(path.dirname(localPath));

    // Check if file already exists
    try {
      await fs.promises.access(localPath);
      return localPath; // File already exists
    } catch (error) {
      // File doesn't exist, proceed with download
    }

    // Download the image with timeout
    return downloadWithTimeout(encodedUrl, localPath, 30000); // 30 second timeout
  } catch (error) {
    console.error(`Error downloading image ${imageUrl}:`, error);
    return null;
  }
}

// Download with timeout support
function downloadWithTimeout(url, localPath, timeout = 30000) {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(localPath);
    let isResolved = false;

    // Set up timeout
    const timer = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        file.destroy();
        if (fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
        }
        console.error(`Download timeout for ${url}`);
        resolve(null);
      }
    }, timeout);

    const request = https.get(url, (response) => {
      // Handle redirects
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        clearTimeout(timer);
        file.destroy();
        if (fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
        }
        // Recursively follow redirect with same timeout
        const redirectUrl = new URL(response.headers.location, url).href;
        downloadWithTimeout(redirectUrl, localPath, timeout).then(resolve);
        return;
      }

      if (response.statusCode === 200) {
        response.pipe(file);

        file.on('finish', () => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timer);
            file.close();
            // Image downloaded successfully
            resolve(localPath);
          }
        });

        file.on('error', (error) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timer);
            file.close();
            if (fs.existsSync(localPath)) {
              fs.unlinkSync(localPath);
            }
            console.error(`File write error for ${url}:`, error);
            resolve(null);
          }
        });
      } else {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timer);
          file.close();
          if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
          }
          console.error(`Failed to download ${url}: ${response.statusCode}`);
          resolve(null);
        }
      }
    });

    request.on('error', (error) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timer);
        file.destroy();
        if (fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
        }
        console.error(`Network error downloading ${url}:`, error);
        resolve(null);
      }
    });

    // Set request timeout
    request.setTimeout(timeout, () => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timer);
        request.destroy();
        file.destroy();
        if (fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
        }
        console.error(`Request timeout for ${url}`);
        resolve(null);
      }
    });
  });
}
