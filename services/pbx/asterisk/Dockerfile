FROM debian:bookworm-slim

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends asterisk ca-certificates gettext-base \
    && rm -rf /var/lib/apt/lists/*
COPY config /opt/vocivo/config
COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
EXPOSE 5060/udp 5060/tcp 5061/tcp 10000-20000/udp
ENTRYPOINT ["/entrypoint.sh"]
