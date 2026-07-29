// Package temlhost is a framework-neutral Go library for driving [teml run]
// over NDJSON stdio. The host owns the real terminal (raw mode, input decoding,
// repaint, cleanup); TeML owns parsing, layout, hit-testing, and rendering.
//
// Subpackages:
//
//   - [github.com/fogha/teml/hosts/go/protocol]: typed wire commands and events (protocol 1.3, including document mutations)
//   - [github.com/fogha/teml/hosts/go/ndjson]: backpressure-safe line splitting with 8 MiB cap
//   - [github.com/fogha/teml/hosts/go/screen]: full/patch frame reconstruction
//   - [github.com/fogha/teml/hosts/go/engine]: engine discovery (Node scripts and native SEA binaries) and Session I/O
//   - [github.com/fogha/teml/hosts/go/terminal]: POSIX-first raw mode, ONLCR paint, input
//
// See docs/host-porting-playbook.md for a language-neutral porting checklist.
//
// [teml run]: https://github.com/fogha/teml/blob/main/docs/interactive-protocol.md
package temlhost
