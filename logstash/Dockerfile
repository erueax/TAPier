# logstash/Dockerfile
FROM docker.elastic.co/logstash/logstash:9.4.2

# for input from mv3 extension
COPY word_checks.template.json /usr/share/logstash/templates/word_checks.json
