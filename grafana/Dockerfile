FROM grafana/grafana:13.0.2

USER root

RUN grafana cli --pluginsDir /usr/share/grafana/data/plugins-bundled plugins update elasticsearch || true

USER grafana

ENV GF_PLUGINS_PREINSTALL_DISABLED=true