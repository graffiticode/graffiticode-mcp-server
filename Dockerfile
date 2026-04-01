FROM node:22-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy built files
COPY dist ./dist

# Copy static assets
COPY favicon.ico ./

CMD [ "node", "dist/server.js" ]
