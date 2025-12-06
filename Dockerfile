FROM node:18-alpine

# Install FFmpeg
RUN apk add --no-cache ffmpeg curl

# Create app directory
WORKDIR /app

# Copy package files from cloud-run-assembler
COPY cloud-run-assembler/package*.json ./

# Install dependencies
RUN npm install --production

# Copy app source from cloud-run-assembler
COPY cloud-run-assembler/server.js .

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Start the service
CMD ["node", "server.js"]
