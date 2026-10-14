#!/bin/sh
# Ghi CPU/RAM của từng container mỗi 5s ra CSV để quy đổi cấu hình VPS.
# Dùng: sh loadtest/collect-docker-stats.sh loadtest/results/docker-stats.csv  (Ctrl+C để dừng)
OUT="${1:-loadtest/results/docker-stats.csv}"
mkdir -p "$(dirname "$OUT")"
echo "time,container,cpu_percent,mem_usage,mem_percent" > "$OUT"
while true; do
	docker stats --no-stream --format "$(date +%H:%M:%S),{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}}" >> "$OUT"
	sleep 5
done
