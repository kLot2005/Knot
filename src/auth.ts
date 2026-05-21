import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
// @ts-ignore
import * as input from 'input';
import { config } from './config';

const client = new TelegramClient(new StringSession(''), config.apiId, config.apiHash, {
    connectionRetries: 5,
});

async function login() {
    console.log('Logging in to Telegram...');
    await client.start({
        phoneNumber: async () => await input.text('Please enter your number: '),
        password: async () => await input.text('Please enter your password: '),
        phoneCode: async () => await input.text('Please enter the code you received: '),
        onError: (err) => console.log(err),
    });
    console.log('You should now be connected.');
    console.log('Your session string is: ', client.session.save());
    console.log('Save this string in your .env file as TELEGRAM_SESSION');
    await client.disconnect();
}

login().catch(console.error);
