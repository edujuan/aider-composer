import { spawn, ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { isProductionMode } from './utils/isProductionMode';
import { spawnSync } from 'node:child_process';

export default class AiderChatService {
  private aiderChatProcess: ChildProcess | undefined;

  port: number = 0;

  onStarted: () => void = () => { };
  onError: (error: Error) => void = () => { };

  constructor(
    private context: vscode.ExtensionContext,
    private outputChannel: vscode.LogOutputChannel,
  ) { }

  async start() {
    // First check if Python and required packages are installed
    const pythonPath = await this.findPythonPath();
    if (!pythonPath) {
      this.outputChannel.error('Could not find Python installation');
      return Promise.reject(new Error('Python not found'));
    }

    // Check for required packages
    try {
      const checkProcess = spawn(pythonPath, [
        '-c',
        'import flask, aider; print("Required packages are installed")',
      ]);

      checkProcess.stderr.on('data', (data) => {
        this.outputChannel.error(`Package check stderr: ${data}`);
      });

      checkProcess.stdout.on('data', (data) => {
        this.outputChannel.info(`Package check stdout: ${data}`);
      });

      await new Promise((resolve, reject) => {
        checkProcess.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Package check failed with code ${code}`));
          } else {
            resolve(true);
          }
        });
      });
    } catch (e) {
      this.outputChannel.error(`Failed to verify Python packages: ${e}`);
      vscode.window.showErrorMessage(
        'Required Python packages (flask, aider) are not installed. Please run: pip install flask aider-chat',
      );
      return Promise.reject(e);
    }

    this.outputChannel.info('Starting aider-chat service...');
    this.outputChannel.info(`Using Python path: ${pythonPath}`);
    this.outputChannel.info(`Process platform: ${process.platform}`);
    this.outputChannel.info(`PATH environment: ${process.env.PATH}`);

    if (!isProductionMode(this.context)) {
      this.port = 5000;
      this.onStarted();
      return;
    }

    const folderPath = await this.getWorkspacePath();
    if (!folderPath) {
      return Promise.reject(new Error('No workspace folder found'));
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Starting aider-chat service...',
        cancellable: false,
      },
      async () => {
        const randomPort = Math.floor(Math.random() * 10000) + 10000;
        const env = { ...process.env, PYTHONUNBUFFERED: '1' };

        return new Promise<void>((resolve, reject) => {
          const aiderChatProcess = spawn(
            pythonPath,
            [
              '-m',
              'flask',
              '--app',
              path.join(this.context.extensionUri.fsPath, 'server/main.py'),
              'run',
              '--port',
              randomPort.toString(),
              '--debug',
            ],
            {
              cwd: folderPath,
              env,
            },
          );

          this.outputChannel.info(
            'Starting Flask server with command:',
            `${pythonPath} ${aiderChatProcess.spawnargs.join(' ')}`,
          );

          this.aiderChatProcess = aiderChatProcess;

          let isRunning = false;

          const checkServerRunning = (line: string) => {
            if (
              !isRunning &&
              line.includes(`Running on http://127.0.0.1:${randomPort}`)
            ) {
              isRunning = true;
              this.port = randomPort;
              clearTimeout(timer);
              this.outputChannel.info('Server started successfully');
              this.onStarted();
              resolve();
            }
          };

          if (aiderChatProcess.stderr) {
            const rlStdErr = readline.createInterface({
              input: aiderChatProcess.stderr,
            });

            rlStdErr.on('line', (line) => {
              this.outputChannel.error(`Flask stderr: ${line}`);
              checkServerRunning(line);
            });
          }

          if (aiderChatProcess.stdout) {
            const rlStdOut = readline.createInterface({
              input: aiderChatProcess.stdout,
            });

            rlStdOut.on('line', (line) => {
              this.outputChannel.info(`Flask stdout: ${line}`);
              checkServerRunning(line);
            });
          }

          const timer = setTimeout(() => {
            this.stop();
            reject(new Error('Flask server start timeout'));
          }, 30000);

          aiderChatProcess.on('error', (err) => {
            clearTimeout(timer);
            this.outputChannel.error(`Flask process error: ${err}`);
            reject(err);
          });

          aiderChatProcess.on('exit', (code, signal) => {
            clearTimeout(timer);
            if (!isRunning) {
              const errorMsg = `Flask process exited with code ${code} and signal ${signal}`;
              this.outputChannel.error(errorMsg);
              reject(new Error(errorMsg));
            }
          });
        });
      },
    );
  }

  restart() {
    this.outputChannel.info('Restarting aider-chat service...');
    this.stop();
    this.start();
  }

  stop() {
    this.outputChannel.info('Stopping aider-chat service...');
    this.aiderChatProcess?.kill();
    this.aiderChatProcess = undefined;
  }

  private async findPythonPath(): Promise<string | undefined> {
    // Hardcode Python path for now
    return '/usr/local/bin/python3.11';

    // Keep original code commented for reference
    /*
    const pythonCommands = ['python3.11', 'python3', 'python'];

    for (const cmd of pythonCommands) {
      try {
        const result = spawnSync(cmd, ['-V']);
        if (result.status === 0) {
          return cmd;
        }
      } catch (e) {
        // Continue to next command
      }
    }

    return undefined;
    */
  }

  private async getWorkspacePath(): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.outputChannel.warn('No workspace folders found');
      vscode.window.showWarningMessage('No workspace folders found');
      return undefined;
    }

    if (folders.length > 1) {
      this.outputChannel.warn('Multiple workspace folders found');
      vscode.window.showWarningMessage('Only single workspace folder is supported');
      return undefined;
    }

    return folders[0].uri.fsPath;
  }
}
