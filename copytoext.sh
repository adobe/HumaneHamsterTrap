#!/bin/bash

# Copyright 2023 Adobe
# All Rights Reserved.
# NOTICE: Adobe permits you to use, modify, and distribute this file in
# accordance with the terms of the Adobe license agreement accompanying
#it.

cat <<EOT >> genheader_tmp.html
<!-- Generated file. DO NOT EDIT. 
     This file was copied from the parent directory using
     copytoext.sh
     It is checked in for extension packing convenience only. -->

EOT

cat <<EOT >> genheader_tmp.js
// Generated file. DO NOT EDIT. 
// This file was copied from the parent directory using
// copytoext.sh
// It is checked in for extension packing convenience only.

EOT

cat genheader_tmp.js wgpucap.js | sed 's/export//g' > chrome_extension/ext/wgpucapext.js
cat genheader_tmp.js main.js > chrome_extension/ext/main.js
cat genheader_tmp.html index.html > chrome_extension/ext/indexext.html
cat readme.md > chrome_extension/ext/readmeext.md

rm genheader_tmp.js
rm genheader_tmp.html

