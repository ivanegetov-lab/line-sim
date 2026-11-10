#!/bin/sh
# Joins the parts in .build/ into index.html, embeds the presets and refreshes skill/line-sim/assets/simulator.html.
# Usage: sh build_page.sh   (needs python3 and ../plant2-dataset)
cd "$(dirname "$0")" && cat .build/a_head.html .build/b_engine.html .build/c_tools.html .build/d_ui1.html .build/e_ui2.html .build/f_3d.html > index.html && python3 derive_params.py | tail -1
