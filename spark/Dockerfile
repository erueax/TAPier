FROM apache/spark:4.1.2
USER 0
 
# Python 3.11, build tools for fugashi/SudachiPy
RUN apt-get update && \
    apt-get install -y --no-install-recommends software-properties-common && \
    add-apt-repository ppa:deadsnakes/ppa && \
    apt-get update && \
    apt-get install -y --no-install-recommends python3.11 build-essential && \
    update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 && \
    rm -rf /var/lib/apt/lists/*
 
# Python dependencies (fugashi, UniDic, SudachiPy).
COPY dependencies ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r dependencies
 
# Kafka connector
RUN echo "print('deps ok')" > /tmp/warmup.py && \
    /opt/spark/bin/spark-submit \
      --packages org.apache.spark:spark-sql-kafka-0-10_2.13:4.1.2 \
      --conf spark.jars.ivy=/tmp/ivy \
      /tmp/warmup.py && \
    cp /tmp/ivy/jars/*.jar /opt/spark/jars/ && \
    rm -rf /tmp/ivy /tmp/warmup.py
 
COPY . /opt/spark/work-dir
 
USER spark