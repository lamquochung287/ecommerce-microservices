#!/bin/bash
# Chạy 8 app trong cùng container; một app chết thì dừng cả container để lộ lỗi ngay.
for app in user product orders payment notification review promotion gateway; do
	node dist/apps/$app/main.js &
done
wait -n
exit 1
