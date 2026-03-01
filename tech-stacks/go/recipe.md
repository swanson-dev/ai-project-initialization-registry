# Tech Stack Recipe: Go

## Preferred technology
- Go (stable release line)
- Standard library-first service architecture

## Allowed languages
- Go
- Shell scripts for developer tooling only

## Recommended tools
- `go fmt`
- `go test`
- `golangci-lint` (or equivalent)
- `air` or similar local reload tool (optional)

## Forbidden deviations
- Introducing non-Go runtime languages for core services without formal approval.
- Adopting framework-heavy stacks that conflict with standard library-first direction.
- Placing implementation code outside `/app`.

## Mandatory rule
- ALL code inside `/app`.

## Scope note
- Guardrails only. This recipe does not provide scaffolding.
