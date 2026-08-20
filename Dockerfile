FROM node:20-slim

WORKDIR /app

# Copy package files and install
COPY package*.json ./
RUN npm install

# Copy all source code
COPY . .

# Build client (Vite) + server (esbuild). Defined once, in package.json, so a
# local `npm run build` produces exactly what the deployed image runs.
RUN npm run build

# Create data directory for SQLite persistence
RUN mkdir -p /data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000
ENV DATABASE_PATH=/data/jobtrack.db

# Expose port
EXPOSE 5000

# Start the production server
CMD ["node", "dist/index.cjs"]
