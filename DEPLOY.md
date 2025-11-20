# GitHub Pages Deployment Guide

## Automatic Deployment (Recommended)

The project is configured to automatically deploy to GitHub Pages when you push to the `main` branch.

### Setup Steps:

1. **Enable GitHub Pages in your repository:**
   - Go to your repository on GitHub: https://github.com/rohantmp/pathmap
   - Click on "Settings" tab
   - Scroll down to "Pages" in the left sidebar
   - Under "Source", select "GitHub Actions"

2. **Push your changes:**
   ```bash
   git add .
   git commit -m "Add GitHub Pages deployment"
   git push origin main
   ```

3. **Wait for deployment:**
   - Go to the "Actions" tab in your GitHub repository
   - You should see a workflow running
   - Once it completes (usually 2-3 minutes), your site will be available

4. **Access your site:**
   - Your site will be available at: https://rohantmp.github.io/pathmap/
   - The URL is shown in Settings > Pages once deployment is complete

## Manual Deployment (Alternative)

If you prefer to deploy manually:

1. **Build the project locally:**
   ```bash
   npm run build
   ```

2. **Deploy using gh-pages package:**
   ```bash
   # Install gh-pages if not already installed
   npm install --save-dev gh-pages

   # Deploy
   npx gh-pages -d dist
   ```

## Troubleshooting

### If the site doesn't appear:
- Check that GitHub Pages is enabled in Settings > Pages
- Ensure the workflow completed successfully in the Actions tab
- Wait a few minutes for DNS propagation
- Try clearing your browser cache

### If assets don't load:
- The `base: '/pathmap/'` in `vite.config.js` must match your repository name
- If you rename the repository, update this value

### Build fails:
- Check that all dependencies are in `package.json` (not just devDependencies)
- Ensure `npm ci` can run successfully locally
- Check the Actions tab for specific error messages

## Local Development

To test the production build locally:
```bash
npm run build
npm run preview
```

This will show you exactly what will be deployed to GitHub Pages.