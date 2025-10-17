import { useNavigate, useParams } from 'react-router-dom';
import Settings from '~/components/Nav/Settings';
import { useEffect, useState } from 'react';

export default function SettingsRoute() {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const [showSettings, setShowSettings] = useState(true);

  useEffect(() => {
    // Open the settings dialog when the route is loaded
    setShowSettings(true);
  }, [tab]);

  const handleOpenChange = (open: boolean) => {
    setShowSettings(open);
    if (!open) {
      // Navigate back when the dialog is closed
      navigate('/c/new');
    }
  };

  return <Settings open={showSettings} onOpenChange={handleOpenChange} />;
}