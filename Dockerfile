FROM node:22

# Standard working directory
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image.
# A wildcard is used to ensure copying both package.json AND package-lock.json (when available).
COPY package*.json ./

# Install production dependencies.
RUN npm install

# Copy local code to the container image.
COPY . .

# Build the frontend (Vite)
RUN npm run build

# Cloud Run sets PORT environment variable, usually 8080
ENV PORT=8080
EXPOSE 8080

# Run the web service on container startup.
CMD ["node", "server.js"]
