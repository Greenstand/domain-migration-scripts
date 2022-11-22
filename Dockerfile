FROM node:16.18.1

WORKDIR /
COPY . .

RUN yarn install --production
CMD ["node", "."]
EXPOSE 3000