FROM node:10-jessie
# RUN apt-get install -y libkrb5-dev test2
RUN echo "deb [check-valid-until=no] http://archive.debian.org/debian jessie-backports main" > /etc/apt/sources.list.d/jessie-backports.list
RUN sed -i '/deb http:\/\/deb.debian.org\/debian jessie-updates main/d' /etc/apt/sources.list
RUN apt-get -o Acquire::Check-Valid-Until=false update
RUN mkdir -p /usr/src/app
# RUN mkdir -p /usr/src/migrations-custom comment
WORKDIR /usr/src/app
RUN mkdir -p /usr/src/logs
COPY package.json /usr/src/app/
RUN npm config set registry https://registry.npmjs.org/
RUN npm install
COPY . /usr/src/app
#RUN cp /usr/src/app/wait-for-it.sh /usr/local/bin/wait-for-it.sh
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 CMD curl -f http://localhost:8000/api/v1/welcome || exit 1
#ENV NODE_ENV=production\
#	WEB_ENV=production\
#	PLATFORM_RESTAPI_PORT=8000\
#	PLATFORM_TOKEN_EXPIRY=7d\
#	PLATFORM_TOKEN_SECRET=\	
#	PLATFORM_SUPPORT_EMAILS=\
#	PLATFORM_SUPPORT_EMAIL_HOST=\
#	PLATFORM_SUPPORT_EMAIL_USER=\
#	PLATFORM_SUPPORT_EMAIL_PASS=\
#	PLATFORM_SERVERNAME=${HOSTNAME}
#	WWW_LOG_LEVEL=info\
#	WWW_LOG_LIMIT=30d\
#	WWW_ACTIVE_LOG_SIZE=10000000\
# WWW_ARCHIVE_LOG_SIZE=20000000
ARG BUILD_ENV=production
EXPOSE 8000
CMD ["npm", "start"]
