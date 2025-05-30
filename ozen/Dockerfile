# Use official Node image
FROM node:20

# Set working directory
WORKDIR /app

# Copy package files and install deps
COPY package.json package-lock.json* ./
RUN npm install

# Copy source files
COPY . .

# Build TypeScript (if you're compiling; otherwise, skip if running with ts-node-dev)
RUN npx tsc

# Expose the port
EXPOSE 4000

# Start the server (edit to your actual start command)
CMD ["node", "dist/index.js"]