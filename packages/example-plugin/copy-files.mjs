import { copyFileSync, mkdirSync, existsSync } from 'fs';

if (!existsSync('./dist')) {
    mkdirSync('./dist');
}

copyFileSync('./styles.css', './dist/styles.css');
copyFileSync('./manifest.json', './dist/manifest.json'); 