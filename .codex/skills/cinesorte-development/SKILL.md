---
name: cinesorte-development
description: Desenvolver, corrigir ou revisar o frontend cinesorte e o cinesorte-backend, aplicando as convenções obrigatórias de branch, pull request e commits dos dois repositórios.
---

# Desenvolvimento CineSorte

Use esta skill para alterações em `cinesorte` e `cinesorte-backend`.

## Repositórios

- Frontend: `C:\Users\Brian\repos\cinesorte`
- Backend: `C:\Users\Brian\repos\cinesorte-backend`

## Git e pull requests

- Nunca abra pull request contra `main`. A branch base obrigatória é sempre `dev`.
- Antes de abrir um PR, confirme explicitamente que a base selecionada é `dev`.
- Use Conventional Commits no formato `tipo(escopo): descrição`, com tipos como `feat`, `fix`, `refactor`, `test`, `docs` e `chore`.
- Faça exatamente um commit por arquivo alterado. Não agrupe dois ou mais arquivos no mesmo commit, mesmo quando pertencem à mesma funcionalidade.
- Cada commit deve incluir somente aquele arquivo e ter uma mensagem Conventional Commit que descreva sua alteração.
- Não crie commits nem abra PR sem autorização do usuário. Quando autorizado, preserve mudanças preexistentes e não relacionadas.

Ao entregar uma alteração ainda não commitada, proponha mensagens de commit individuais por arquivo quando isso for útil para o próximo passo.
