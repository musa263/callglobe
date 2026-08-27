FROM debian:bookworm

ARG FREESWITCH_VERSION=v1.11.1
ARG LIBKS_VERSION=v2.0.11
ARG SOFIA_SIP_VERSION=v1.13.18
ARG SPANDSP_VERSION=v3.1.1
ARG SIGNALWIRE_C_VERSION=v2.0.5

RUN groupadd --system --gid 499 freeswitch \
    && useradd --system --uid 499 --gid freeswitch --home-dir /usr/local/freeswitch --shell /usr/sbin/nologin freeswitch \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      autoconf automake bison build-essential ca-certificates cmake curl git libavcodec-dev libavformat-dev \
      libavutil-dev \
      libcurl4-openssl-dev libdb-dev libedit-dev libexpat1-dev libflac-dev libgdbm-dev \
      libldns-dev liblua5.2-dev libmp3lame-dev libmpg123-dev libncurses-dev libogg-dev \
      libopus-dev libpcre2-dev libpq-dev libshout3-dev libsndfile1-dev libspeex-dev \
      libspeexdsp-dev libsqlite3-dev libssl-dev libswresample-dev libswscale-dev libtiff-dev libtool-bin \
      libtpl-dev libvorbis-dev lsb-release nasm netcat-openbsd pkg-config tini unixodbc-dev uuid-dev \
      wget zlib1g-dev \
    && git clone --depth 1 --branch "${FREESWITCH_VERSION}" https://github.com/signalwire/freeswitch /usr/src/freeswitch \
    && git clone --depth 1 --branch "${LIBKS_VERSION}" https://github.com/signalwire/libks /usr/src/libs/libks \
    && git clone --depth 1 --branch "${SOFIA_SIP_VERSION}" https://github.com/freeswitch/sofia-sip /usr/src/libs/sofia-sip \
    && git clone --depth 1 --branch "${SPANDSP_VERSION}" https://github.com/freeswitch/spandsp /usr/src/libs/spandsp \
    && git clone --depth 1 --branch "${SIGNALWIRE_C_VERSION}" https://github.com/signalwire/signalwire-c /usr/src/libs/signalwire-c

RUN cd /usr/src/libs/libks \
    && git fetch --unshallow --tags \
    && cmake . -DCMAKE_INSTALL_PREFIX=/usr -DWITH_LIBBACKTRACE=1 \
    && make -j"$(nproc)" install \
    && cd /usr/src/libs/sofia-sip \
    && ./bootstrap.sh \
    && ./configure --with-pic --with-glib=no --without-doxygen --disable-stun --prefix=/usr \
    && make -j"$(nproc)" install \
    && cd /usr/src/libs/spandsp \
    && ./bootstrap.sh \
    && ./configure --with-pic --prefix=/usr \
    && make -j"$(nproc)" install \
    && cd /usr/src/libs/signalwire-c \
    && PKG_CONFIG_PATH=/usr/lib/pkgconfig cmake . -DCMAKE_INSTALL_PREFIX=/usr \
    && make -j"$(nproc)" install

RUN cd /usr/src/freeswitch \
    && sed -i 's|#endpoints/mod_verto|endpoints/mod_verto|' build/modules.conf.in \
    && sed -i 's|#codecs/mod_opus|codecs/mod_opus|' build/modules.conf.in \
    && sed -i 's|#xml_int/mod_xml_curl|xml_int/mod_xml_curl|' build/modules.conf.in \
    && ./bootstrap.sh -j \
    && ./configure --prefix=/usr/local/freeswitch \
    && make -j"$(nproc)" \
    && make install

RUN cd /usr/src/freeswitch \
    && make samples

RUN cd /usr/src/freeswitch \
    && make cd-sounds-install cd-moh-install \
    && rm -rf /usr/src/* /var/lib/apt/lists/*

COPY config /opt/vocivo/config
COPY entrypoint.sh /usr/local/bin/vocivo-freeswitch-entrypoint

RUN chmod 755 /usr/local/bin/vocivo-freeswitch-entrypoint \
    && mkdir -p \
      /var/lib/vocivo/recordings \
      /usr/local/freeswitch/var/lib/freeswitch/db \
      /usr/local/freeswitch/var/log/freeswitch \
      /usr/local/freeswitch/var/run/freeswitch \
      /usr/local/freeswitch/share/freeswitch/sounds \
    && chown -R freeswitch:freeswitch \
      /var/lib/vocivo \
      /usr/local/freeswitch/var/lib/freeswitch \
      /usr/local/freeswitch/var/log/freeswitch \
      /usr/local/freeswitch/var/run/freeswitch \
      /usr/local/freeswitch/share/freeswitch/sounds \
    && chmod 750 /var/lib/vocivo/recordings

EXPOSE 5060/udp 5060/tcp 5061/tcp 5066/tcp 7443/tcp 8081/tcp 20000-29999/udp

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/vocivo-freeswitch-entrypoint"]
