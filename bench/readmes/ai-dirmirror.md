# 🔄 dirmirror

![Node.js](https://img.shields.io/badge/node-%3E%3D22.18-brightgreen) ![Platform](https://img.shields.io/badge/platform-macOS-lightgrey) ![License: MIT](https://img.shields.io/badge/license-MIT-blue) ![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange)

> **A powerful, robust and blazing-fast file synchronization tool for macOS virtual machines.** 🚀

## 📑 Table of Contents

- [Overview](#-overview)
- [Why dirmirror?](#-why-dirmirror)
- [Features](#-features)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Getting Started](#-getting-started)
- [Usage](#-usage)
- [Configuration](#-configuration)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [License](#-license)
- [Acknowledgements](#-acknowledgements)

## 🌟 Overview

dirmirror is a comprehensive, developer-friendly solution for keeping your project folders in perfect harmony between a macOS host and its macOS guest virtual machine. By leveraging the proven power of `rsync` over SSH, dirmirror delivers a seamless synchronization experience that just works.

Whether you're a seasoned developer juggling multiple VMs or just getting started with virtualization, dirmirror empowers you to take full control of your development workflow.

## 💡 Why dirmirror?

In today's fast-paced development landscape, working across virtual machines has become increasingly common. However, traditional file sharing solutions often fall short. virtiofs shared folders, for instance, can become unreliable when handling large numbers of small files, leading to cache corruption and frustrating data integrity issues.

dirmirror addresses these challenges head-on by providing a robust, SSH-based alternative that puts you firmly in control. Instead of relying on shared folders, it uses battle-tested `rsync` technology to ensure your files are transferred safely and reliably, every single time.

## ✨ Features

- 🚀 **Blazing Fast**: Leverages the power of `rsync` for lightning-quick, efficient transfers
- 🔒 **Secure by Design**: Uses a dedicated SSH key and pins the guest's host key for enhanced security
- 🧙 **Interactive Wizard**: An intuitive, user-friendly menu makes syncing effortless
- 👀 **Dry-Run Previews**: See exactly what will change before you commit to a sync
- 🔍 **Automatic VM Discovery**: Finds your running VM automatically, no configuration needed!
- 🛡️ **virtiofs Protection**: Intelligently refuses to touch virtiofs mounts
- 🎯 **Smart Ignore Lists**: Automatically skips `node_modules`, build output and other regenerable files
- 📦 **Zero Dependencies**: No runtime dependencies whatsoever
- 📝 **Session Logging**: Comprehensive logging for easy troubleshooting

## 📋 Prerequisites

Before you begin, please ensure that you have the following installed and configured on your system:

- **Node.js 22.18 or newer**: dirmirror is written in TypeScript and relies on Node's built-in TypeScript support. You can download Node.js from the [official website](https://nodejs.org/). To check which version you have, open your terminal and run `node --version`.
- **A macOS host machine**: dirmirror is designed to run on the host.
- **A macOS guest VM**: For example, a virtual machine created with Tart.
- **SSH access**: The guest must have Remote Login enabled.

## 🛠️ Installation

Getting dirmirror up and running is quick and easy! Simply follow these steps:

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-username/dirmirror.git
   ```

2. **Navigate to the project directory**

   ```bash
   cd dirmirror
   ```

3. **That's it!** 🎉 There is no build step and there are no dependencies to install.

## 🚀 Getting Started

### Step 1: Enable Remote Login on the Guest

In your guest VM, open **System Settings** → **General** → **Sharing** and turn on **Remote Login**.

### Step 2: Run the Setup Command

On your host machine, run:

```bash
./dirmirror setup
```

The setup process will automatically discover your running VM, create a dedicated SSH key, and generate a one-liner that you can paste into the guest to authorize the host.

### Step 3: Start Syncing!

You're all set! Launch the wizard with:

```bash
./dirmirror
```

## 📖 Usage

Using dirmirror is simple and intuitive:

1. Run `./dirmirror` to launch the interactive wizard
2. Select the mapping you want to sync
3. Choose a direction:
   - **Pull**: Guest → Host
   - **Push**: Host → Guest
4. Review the dry-run preview
5. Confirm the transfer

> ⚠️ **Note:** Each sync is a true mirror (`rsync -a --delete`), which means the destination will be made to match the source exactly. Please make sure you understand this before syncing!

## ⚙️ Configuration

dirmirror stores its configuration in `~/.config/dirmirror/`. You can customize the following settings:

| Setting      | Description                        |
| ------------ | ---------------------------------- |
| `GUEST_IP`   | The IP address of the guest VM     |
| `GUEST_USER` | The username on the guest          |
| `GUEST_BASE` | The base folder on the guest       |
| `HOST_BASE`  | The base folder on the host        |
| `EXCLUDES`   | Additional patterns to ignore      |
| `INCLUDES`   | Patterns to force-include          |
| `LOGGING`    | Whether session logging is enabled |

All of these settings can be conveniently edited from the wizard's settings screen.

## 🔧 Troubleshooting

If you encounter any issues while using dirmirror, here are some helpful tips:

- **Can't connect to the guest?** Make sure Remote Login is enabled on the guest and that the VM is running.
- **Sync failed?** dirmirror prints the exact `rsync` command it ran, so you can paste it into a shell to reproduce the problem.
- **Still stuck?** Enable session logging by pressing `l` in the menu, then check `.dirmirror/dirmirror.log` for more details.

## 🤝 Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**!

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

## 🙏 Acknowledgements

- [rsync](https://rsync.samba.org/) for the incredible sync engine
- [Tart](https://tart.run/) for making macOS virtualization accessible
- All the amazing contributors who help make dirmirror better every day ❤️
