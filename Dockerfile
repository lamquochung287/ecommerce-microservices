FROM node:18-alpine AS development

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

# Argument for the app name to build (e.g. gateway, product, user, orders)
ARG APP_NAME
ENV APP_NAME=${APP_NAME}

RUN npm run build ${APP_NAME}

FROM node:18-alpine AS production

ARG APP_NAME
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}
ENV APP_NAME=${APP_NAME}

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --omit=dev

# Copy only the built dist folder for the specific app and common libraries
COPY --from=development /usr/src/app/dist ./dist

# NestJS monorepo build outputs to dist/apps/${APP_NAME}/main.js
CMD ["sh", "-c", "node dist/apps/${APP_NAME}/main.js"]
