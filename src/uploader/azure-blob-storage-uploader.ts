import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import * as fs from 'fs';
import * as path from 'path';

export class AzureBlobStorageUploader {
    private containerName: string;
    private localReportDir: string;
    private connectionString: string;
    private runId: string;
    private blobServiceClient: BlobServiceClient;
    private containerClient: ContainerClient;
    private appName: string;

    constructor({ runId, appName, containerName, connectionString, reportDir }: { runId: string, appName: string, connectionString: string, containerName: string, reportDir: string }) {
        this.runId = runId;
        this.containerName = containerName;
        this.localReportDir = path.resolve(process.cwd(), reportDir);
        this.appName = appName;

        // Retrieve connection string from environment variables
        this.connectionString = connectionString || '';
        if (!this.connectionString) {
            throw new Error('Azure Storage connection string is missing!');
        }

        // Initialize Azure Blob Service Client and Container Client
        this.blobServiceClient = BlobServiceClient.fromConnectionString(this.connectionString);
        this.containerClient = this.blobServiceClient.getContainerClient(this.containerName);
    }

    /**
     * Reads JSON data from a file and parses it into an object.
     * @param file The file path to read from.
     * @returns Parsed JSON data as an object or null in case of error.
     */
    private readJsonFile(file: string): any {
        try {
            const fileContent = fs.readFileSync(file, 'utf8');
            return JSON.parse(fileContent);
        } catch (error: any) {
            console.error(`Error reading or parsing the file: ${error.message}`);
            return null;
        }
    }

    /**
     * Recursively uploads all files and folders from the given directory to Azure Blob Storage.
     * @param directoryPath The local directory to be uploaded.
     * @param containerClient The Azure container client.
     * @param remotePath The remote path (directory) in Azure Blob Storage.
     */
    private async uploadDirectoryToBlobStorage(directoryPath: string, containerClient: ContainerClient, remotePath: string) {
        console.log('uploadDirectoryToBlobStorage', remotePath);
        const files = fs.readdirSync(directoryPath, { withFileTypes: true });

        for (const file of files) {
            const localFilePath = path.join(directoryPath, file.name);
            const blobPath = path.join(remotePath, file.name).replace(/\\/g, '/'); // Ensure the path uses '/' for Azure

            if (file.isDirectory()) {
                // If it's a directory, recursively upload its contents
                await this.uploadDirectoryToBlobStorage(localFilePath, containerClient, blobPath);
            } else {
                // If it's a file, upload it
                const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
                const fileContent = fs.readFileSync(localFilePath);

                await blockBlobClient.uploadData(fileContent, {
                    blobHTTPHeaders: {
                        blobContentType: this.getContentType(file.name), // Set the content type based on the file extension
                    },
                });
                console.log(`Uploaded: ${blobPath}`);
            }
        }
    }

    /**
     * Get content type based on file extension.
     * @param fileName The name of the file.
     * @returns The content type for the file.
     */
    private getContentType(fileName: string): string {
        const extension = path.extname(fileName).toLowerCase();
        switch (extension) {
            case '.html':
                return 'text/html';
            case '.json':
                return 'application/json';
            case '.txt':
                return 'text/plain';
            case '.png':
                return 'image/png';
            case '.jpg':
            case '.jpeg':
                return 'image/jpeg';
            default:
                return 'application/octet-stream'; // Default content type for binary files
        }
    }

    /**
     * Uploads the Playwright report directory to Azure Blob Storage under a unique runId directory.
     */
    public async uploadPlaywrightReport() {
        try {
            console.log('Azure Storage Connection String:', this.connectionString);
            console.log('Container Name:', this.containerName);

            // Create the container if it does not exist
            await this.containerClient.createIfNotExists({
                access: 'container',
            });

            console.log(`Container "${this.containerName}" is ready.`);

            // Define the remote path in Azure Blob Storage (use runId as the directory name)
            const remotePath = `chalisha-reporter/${this.appName}/${this.runId}`;
 
            // Upload the entire Playwright report directory
            await this.uploadDirectoryToBlobStorage(this.localReportDir, this.containerClient, remotePath);
            console.log(`All files and folders from "${this.localReportDir}" have been uploaded to "${remotePath}" in Azure Blob Storage.`);
        } catch (error: any) {
            console.error('Error uploading report to Azure Blob Storage:', error.message);
        }
    }

     
}
