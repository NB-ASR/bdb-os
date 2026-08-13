type DeploymentEnvironment = {
  VERCEL_ENV?: string;
};

export function previewIsQuarantined(environment?: DeploymentEnvironment) {
  const current = environment ?? {
    VERCEL_ENV: process.env.VERCEL_ENV,
  };

  return current.VERCEL_ENV === "preview";
}
