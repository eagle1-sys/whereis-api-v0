FROM denoland/deno
WORKDIR /app
COPY . .
RUN deno update
RUN deno cache main/main.ts
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "main/main.ts"]
