FROM denoland/deno
WORKDIR /app
COPY . .
RUN deno cache main.ts
CMD ["run", "--allow-import","--allow-net", "--allow-env", "--allow-read", "--allow-write","main.ts"]