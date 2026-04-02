import { loginAndSaveStorageState } from './auth.setup';

export default async function globalSetup(): Promise<void> {
    await loginAndSaveStorageState();
}
