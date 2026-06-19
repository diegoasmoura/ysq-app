FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 7891
ENV PORT=7891
ENV NODE_ENV=production
CMD ["node", "server.js"]