const architectureConfig = {
  moduleDependencies: {
    "learning-assessment": ["learning-catalog"],
    "learning-progress": ["learning-catalog"],
    "learning-report": ["learning-catalog", "learning-progress"],
    "map-generation": [],
  },
};

export default architectureConfig;
