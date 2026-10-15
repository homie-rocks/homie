import { Box, SettingsView } from '@stripe/ui-extension-sdk/ui';
export default function AppSettings() {
  return <SettingsView>
    <Box css={{stack: 'y', gap: 'medium'}}>
      <Box>Connect your Homie studio</Box>
      <Box>With the Homie connection tool running on your computer, choose View API keys, then Generate new key (Reveal key in a sandbox), then Copy.</Box>
      <Box>Homie installs the copied key into your own studio. Do not paste it into chat.</Box>
      <Box>To renew, run the connection tool with renew enabled, then choose Roll key and Copy.</Box>
      <Box>This External test version has not been reviewed by Stripe.</Box>
    </Box>
  </SettingsView>;
}
