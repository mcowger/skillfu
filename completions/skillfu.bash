#!/usr/bin/env bash
# skillfu shell completions for bash
# Install: skillfu completions bash > ~/.local/share/bash-completion/completions/skillfu
# Or:       skillfu completions bash > /etc/bash_completion.d/skillfu

_skillfu_completions() {
  local cur prev words cword
  _init_completion || return

  # If completing the first word after 'skillfu', offer subcommands
  if [[ ${#words[@]} -eq 2 ]]; then
    COMPREPLY=($(compgen -W "add remove install update completions help" -- "${cur}"))
    return
  fi

  local cmd="${words[1]}"

  case "${cmd}" in
    add)
      # Complete options
      case "${prev}" in
        -s|--skill)
          # No dynamic skill completion available
          return
          ;;
        --ref)
          return
          ;;
      esac

      if [[ "${cur}" == -* ]]; then
        COMPREPLY=($(compgen -W "-s --skill -l --local -y --yes --ref" -- "${cur}"))
      fi
      ;;
    remove)
      if [[ "${cur}" == -* ]]; then
        COMPREPLY=($(compgen -W "-l --local -y --yes" -- "${cur}"))
      else
        # Offer installed skill names from lockfile
        local lockfile="$HOME/.config/skillfu/skills.lock"
        if [[ -f "${lockfile}" ]]; then
          local skills=$(grep -o '"[a-z0-9-]*":' "${lockfile}" | tr -d '":' | grep -v version)
          COMPREPLY=($(compgen -W "${skills}" -- "${cur}"))
        fi
      fi
      ;;
    install)
      COMPREPLY=($(compgen -W "-l --local" -- "${cur}"))
      ;;
    update)
      if [[ "${cur}" == -* ]]; then
        COMPREPLY=($(compgen -W "-l --local -s --skill -y --yes" -- "${cur}"))
      else
        case "${prev}" in
          -s|--skill)
            local lockfile="$HOME/.config/skillfu/skills.lock"
            if [[ -f "${lockfile}" ]]; then
              local skills=$(grep -o '"[a-z0-9-]*":' "${lockfile}" | tr -d '":' | grep -v version)
              COMPREPLY=($(compgen -W "${skills}" -- "${cur}"))
            fi
            ;;
        esac
      fi
      ;;
    completions)
      COMPREPLY=($(compgen -W "bash zsh fish" -- "${cur}"))
      ;;
  esac
}

complete -F _skillfu_completions skillfu
