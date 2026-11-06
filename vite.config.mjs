import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({root:'lobby-web',publicDir:'../web/public',plugins:[react()],build:{outDir:'../dist',emptyOutDir:true},server:{fs:{allow:['..']}}});
