import { copyFileSync, mkdirSync, existsSync } from 'fs';

if (!existsSync('./dist')) {
    mkdirSync('./dist');
}

copyFileSync('./src/styles.css', './dist/styles.css');
copyFileSync('./manifest.json', './dist/manifest.json');