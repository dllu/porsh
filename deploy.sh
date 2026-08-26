#!/bin/bash
rsync -av --delete --chmod=D755,F644 \
    dist/ pupserver.linode:/www/misc/959/
