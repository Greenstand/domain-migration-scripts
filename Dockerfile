FROM node:16.18.1

WORKDIR /
COPY ./database ./database
COPY ./tree_migration_milestone1.js ./tree_migration_milestone1.js
COPY ./package.json  ./package.json
COPY yarn.lock ./yarn.lock

RUN yarn install --production
CMD ["node", "tree_migration_milestone1.js"]
EXPOSE 3000