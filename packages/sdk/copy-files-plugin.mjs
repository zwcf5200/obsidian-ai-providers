import { copyFileSync, mkdirSync, existsSync } from 'fs';

export const copyFilesPlugin = (files) => ({
  name: 'copy-files',
  setup(build) {
    build.onEnd(() => {
      if (!existsSync('./dist')) {
        mkdirSync('./dist');
      }

      for (const file of files) {
        copyFileSync(file.from, file.to);
      }
    });
  },
}); 