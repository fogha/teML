# Hostile Markdown

Control in text: red\x1b[31m here

[bad scheme](javascript:alert(1))

[bidi\u202Etext](https://example.com)

![x](javascript:evil())

Raw control in code:

```
line \x1b[31m red
```
