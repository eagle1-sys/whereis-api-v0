FROM denoland/deno
WORKDIR /app
COPY . .
RUN deno update && cache main/main.ts
CMD ["run", "--allow-import","--allow-net", "--allow-env", "--allow-read", "main/main.ts"]
