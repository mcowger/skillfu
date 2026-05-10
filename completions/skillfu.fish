# skillfu shell completions for fish
# Install: skillfu completions fish > ~/.config/fish/completions/skillfu.fish

# Disable file completions by default
complete -c skillfu -f

# Top-level subcommands
complete -c skillfu -n __fish_use_subcommand -a add -d 'Install skills from a GitHub repo or local path'
complete -c skillfu -n __fish_use_subcommand -a remove -d 'Remove installed skills'
complete -c skillfu -n __fish_use_subcommand -a install -d 'Ensure installed skills match the lockfile'
complete -c skillfu -n __fish_use_subcommand -a update -d 'Update skills to their latest versions'
complete -c skillfu -n __fish_use_subcommand -a completions -d 'Output shell completion script'

# add command
complete -c skillfu -n '__fish_seen_subcommand_from add' -s s -l skill -d 'Install specific skill(s) by name' -r
complete -c skillfu -n '__fish_seen_subcommand_from add' -s l -l local -d 'Install to project directory'
complete -c skillfu -n '__fish_seen_subcommand_from add' -s y -l yes -d 'Skip confirmation prompts'
complete -c skillfu -n '__fish_seen_subcommand_from add' -l ref -d 'Git branch or tag' -r

# remove command
complete -c skillfu -n '__fish_seen_subcommand_from remove' -s l -l local -d 'Remove from project scope'
complete -c skillfu -n '__fish_seen_subcommand_from remove' -s y -l yes -d 'Skip confirmation prompts'
# Offer installed skill names
complete -c skillfu -n '__fish_seen_subcommand_from remove' -a '(grep -o \'"[a-z0-9-]*":\' ~/.config/skillfu/skills.lock 2>/dev/null | tr -d \'\":\' | grep -v version)'

# install command
complete -c skillfu -n '__fish_seen_subcommand_from install' -s l -l local -d 'Install from project lockfile'

# update command
complete -c skillfu -n '__fish_seen_subcommand_from update' -s l -l local -d 'Update project-scoped skills'
complete -c skillfu -n '__fish_seen_subcommand_from update' -s s -l skill -d 'Update only specific skill(s)' -r
complete -c skillfu -n '__fish_seen_subcommand_from update' -s y -l yes -d 'Skip confirmation prompts'

# completions command
complete -c skillfu -n '__fish_seen_subcommand_from completions' -a 'bash zsh fish'
