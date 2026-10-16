#!/bin/bash
# Chạy các app trong cùng container; một app chết thì dừng cả container để lộ lỗi ngay.
# SKIP_APPS (cách nhau bằng dấu cách) loại app khỏi container này, vd gateway chạy ở container riêng.
for app in user product orders payment notification review promotion inventory shipping gateway; do
	case " $SKIP_APPS " in *" $app "*) continue ;; esac
	node dist/apps/$app/main.js &
done
wait -n
exit 1
