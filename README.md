> 全是 AI 写的。

# 微信读书网页版无障碍

让 NVDA 等屏幕阅读器可以读取微信读书网页版的正文，并改善目录、字体和字号的键盘操作。支持双栏和上下滚动阅读。

## 安装

先安装 Tampermonkey（篡改猴），再点击[安装脚本](https://greasyfork.org/zh-CN/scripts/599652)。安装后刷新微信读书阅读页面。

## 使用

在 NVDA 浏览模式下，按 H 或 2 跳到“阅读正文”，按 D 跳到正文区域。目录和字体选项可用回车或空格操作，字号可用方向键调整。

部分排版可能出现断句或顺序问题，连续朗读跨页、跨章还需要测试。遇到问题可以[提个 issue](https://github.com/shengrihui/weread-accessibility/issues)，说一下浏览器、NVDA 版本和具体情况。
