import { LogLevel, RelativePattern, Uri, workspace, WorkspaceFolder } from "vscode";
import { TestingConfig } from "./types";
import * as path from "path";
import lodash from "lodash";
import { Logger } from "./logger";
import { getInstance } from "./api/ibmi";

export class ConfigHandler {
    static TESTING_CONFIG_FILE = 'testing.json';
    static GLOBAL_CONFIG_DIRECTORY = '.vscode';

    async getLocalConfig(uri: Uri): Promise<TestingConfig | undefined> {
        const workspaceFolder = workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return;
        }

        try {
            const localConfigUri = await this.findTestingConfig(workspaceFolder, uri);
            const localConfig = localConfigUri ? await this.readTestingConfig(localConfigUri, 'local') : undefined;
            if (localConfigUri && localConfig) {
                Logger.log(LogLevel.Info, `Found local testing configuration at ${localConfigUri.toString()}:\n${JSON.stringify(localConfig, null, 2)}`);
            }

            const globalConfigUri = Uri.joinPath(workspaceFolder.uri, ConfigHandler.GLOBAL_CONFIG_DIRECTORY, ConfigHandler.TESTING_CONFIG_FILE);
            const globalConfig = await this.readTestingConfig(globalConfigUri, 'global');
            if (globalConfig) {
                Logger.log(LogLevel.Info, `Found global testing configuration at ${globalConfigUri.toString()}:\n${JSON.stringify(globalConfig, null, 2)}`);
            }

            const mergedConfig = lodash.merge({}, globalConfig, localConfig);
            Logger.log(LogLevel.Info, `Merged local testing configuration:\n${JSON.stringify(mergedConfig, null, 2)}`);
            return mergedConfig;
        } catch (error: any) {
            Logger.logWithNotification(LogLevel.Error, `Failed to retrieve local testing configuration`, error);
            return;
        }
    }

    async getRemoteConfig(uri: Uri): Promise<TestingConfig | undefined> {
        const ibmi = getInstance();
        const connection = ibmi!.getConnection();

        const parsedPath = connection.parserMemberPath(uri.path);
        const memberPath = parsedPath.asp ?
            path.posix.join(parsedPath.asp, parsedPath.library, parsedPath.file, ConfigHandler.TESTING_CONFIG_FILE) :
            path.posix.join(parsedPath.library, parsedPath.file, ConfigHandler.TESTING_CONFIG_FILE);
        const remoteConfigUri = Uri.from({ scheme: 'member', path: `/${memberPath}` });

        const remoteConfig = await this.readTestingConfig(remoteConfigUri, 'remote');
        if (remoteConfig) {
            Logger.log(LogLevel.Info, `Found remote testing configuration at ${remoteConfigUri.toString()}:\n${JSON.stringify(remoteConfig, null, 2)}`);
        }

        return remoteConfig;
    }

    private async findTestingConfig(workspaceFolder: WorkspaceFolder, uri: Uri): Promise<Uri | undefined> {
        const parentDirectory = path.parse(uri.fsPath).dir;
        if (parentDirectory.startsWith(workspaceFolder.uri.fsPath)) {
            const testingConfigUris = await workspace.findFiles(new RelativePattern(parentDirectory, ConfigHandler.TESTING_CONFIG_FILE));

            if (testingConfigUris.length > 0) {
                return testingConfigUris[0];
            } else {
                return this.findTestingConfig(workspaceFolder, Uri.parse(parentDirectory));
            }
        }
    };

    private async readTestingConfig(testingConfigUri: Uri, type: 'local' | 'remote' | 'global'): Promise<TestingConfig | undefined> {
        try {
            // Check if file exists
            await workspace.fs.stat(testingConfigUri);
        } catch (error: any) {
            Logger.log(LogLevel.Info, `No ${type} testing configuration found at ${testingConfigUri.toString()}`);
            return;
        }

        try {
            // Read and parse file
            let testingConfig;
            if (type === 'local' || type === 'global') {
                testingConfig = await workspace.fs.readFile(testingConfigUri);
            } else {
                const ibmi = getInstance();
                const connection = ibmi!.getConnection();
                const content = connection.getContent();

                const parsedPath = connection.parserMemberPath(testingConfigUri.path);
                testingConfig = await content.downloadMemberContent(parsedPath.library, parsedPath.file, parsedPath.name);
            }

            return JSON.parse(testingConfig.toString()) as TestingConfig;
        } catch (error: any) {
            Logger.logWithNotification(LogLevel.Error, `Failed to read testing configuration`, `${testingConfigUri} - ${error}`);
            return;
        }
    }
}