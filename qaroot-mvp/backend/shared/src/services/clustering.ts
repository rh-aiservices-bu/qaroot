/**
 * Question Clustering Service
 * Groups similar questions using cosine similarity on embeddings
 */

export interface QuestionWithEmbedding {
  id: string;
  text: string;
  embedding: number[];
}

export interface ClusterResult {
  clusterId: string;
  questionIds: string[];
  questions: string[];
  representativeQuestion?: string;
  summary?: string;
  size: number;
}

/**
 * Calculate cosine similarity between two vectors
 * @param a First vector
 * @param b Second vector
 * @returns Similarity score (0 to 1, where 1 is identical)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * Cluster questions using agglomerative clustering based on cosine similarity
 * @param questions Questions with embeddings
 * @param similarityThreshold Minimum similarity to group questions (default: 0.85)
 * @returns Array of clusters
 */
export function clusterQuestions(
  questions: QuestionWithEmbedding[],
  similarityThreshold: number = 0.85
): ClusterResult[] {
  if (questions.length === 0) {
    return [];
  }

  // Initialize each question as its own cluster
  const clusters: Map<string, Set<string>> = new Map();
  questions.forEach((q) => {
    clusters.set(q.id, new Set([q.id]));
  });

  // Create a map for quick question lookup
  const questionMap = new Map(questions.map((q) => [q.id, q]));

  // Build similarity matrix and merge similar clusters
  const processedPairs = new Set<string>();

  for (let i = 0; i < questions.length; i++) {
    for (let j = i + 1; j < questions.length; j++) {
      const q1 = questions[i];
      const q2 = questions[j];

      const pairKey = `${q1.id}-${q2.id}`;
      if (processedPairs.has(pairKey)) {
        continue;
      }
      processedPairs.add(pairKey);

      const similarity = cosineSimilarity(q1.embedding, q2.embedding);

      if (similarity >= similarityThreshold) {
        // Find clusters containing these questions
        let cluster1Id: string | null = null;
        let cluster2Id: string | null = null;

        for (const [clusterId, members] of clusters.entries()) {
          if (members.has(q1.id)) cluster1Id = clusterId;
          if (members.has(q2.id)) cluster2Id = clusterId;
        }

        // Merge clusters if they're different
        if (cluster1Id && cluster2Id && cluster1Id !== cluster2Id) {
          const cluster1 = clusters.get(cluster1Id)!;
          const cluster2 = clusters.get(cluster2Id)!;

          // Merge cluster2 into cluster1
          cluster2.forEach((qId) => cluster1.add(qId));

          // Remove cluster2
          clusters.delete(cluster2Id);
        }
      }
    }
  }

  // Convert clusters to output format
  const result: ClusterResult[] = [];
  let clusterIndex = 1;

  for (const [clusterId, members] of clusters.entries()) {
    const questionIds = Array.from(members);
    const questionsInCluster = questionIds.map((id) => questionMap.get(id)!.text);

    result.push({
      clusterId: `cluster-${clusterIndex++}`,
      questionIds,
      questions: questionsInCluster,
      size: questionIds.length,
    });
  }

  // Sort by cluster size (largest first)
  result.sort((a, b) => b.size - a.size);

  return result;
}

/**
 * Get average embedding for a cluster (centroid)
 * @param questions Questions in the cluster
 * @returns Average embedding vector
 */
export function getClusterCentroid(questions: QuestionWithEmbedding[]): number[] {
  if (questions.length === 0) {
    return [];
  }

  const dimensions = questions[0].embedding.length;
  const centroid = new Array(dimensions).fill(0);

  for (const question of questions) {
    for (let i = 0; i < dimensions; i++) {
      centroid[i] += question.embedding[i];
    }
  }

  for (let i = 0; i < dimensions; i++) {
    centroid[i] /= questions.length;
  }

  return centroid;
}

/**
 * Find the most representative question in a cluster
 * (closest to the centroid)
 * @param questions Questions in the cluster
 * @returns Most representative question
 */
export function findRepresentativeQuestion(
  questions: QuestionWithEmbedding[]
): QuestionWithEmbedding {
  if (questions.length === 1) {
    return questions[0];
  }

  const centroid = getClusterCentroid(questions);

  let mostRepresentative = questions[0];
  let highestSimilarity = cosineSimilarity(questions[0].embedding, centroid);

  for (let i = 1; i < questions.length; i++) {
    const similarity = cosineSimilarity(questions[i].embedding, centroid);
    if (similarity > highestSimilarity) {
      highestSimilarity = similarity;
      mostRepresentative = questions[i];
    }
  }

  return mostRepresentative;
}
