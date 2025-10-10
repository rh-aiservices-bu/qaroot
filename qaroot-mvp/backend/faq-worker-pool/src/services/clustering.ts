import { getPool } from '@qaroot/shared';

const SIMILARITY_THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD || '0.85');
const MIN_CLUSTER_SIZE = parseInt(process.env.MIN_CLUSTER_SIZE || '2', 10);

interface Question {
  id: string;
  question_text: string;
  embedding: number[];
}

interface Cluster {
  questions: Question[];
  centroid: number[];
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
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

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Calculate centroid (average) of multiple embedding vectors
 */
function calculateCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) {
    throw new Error('Cannot calculate centroid of empty array');
  }

  const dimension = embeddings[0].length;
  const centroid = new Array(dimension).fill(0);

  for (const embedding of embeddings) {
    for (let i = 0; i < dimension; i++) {
      centroid[i] += embedding[i];
    }
  }

  for (let i = 0; i < dimension; i++) {
    centroid[i] /= embeddings.length;
  }

  return centroid;
}

/**
 * Cluster questions using agglomerative clustering with cosine similarity
 */
export async function clusterQuestions(questions: Question[]): Promise<Cluster[]> {
  if (questions.length === 0) {
    return [];
  }

  // Initialize each question as its own cluster
  const clusters: Cluster[] = questions.map((q) => ({
    questions: [q],
    centroid: q.embedding,
  }));

  let merged = true;

  // Agglomerative clustering: keep merging until no more similar clusters
  while (merged && clusters.length > 1) {
    merged = false;
    let maxSimilarity = SIMILARITY_THRESHOLD;
    let mergeI = -1;
    let mergeJ = -1;

    // Find most similar pair of clusters
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const similarity = cosineSimilarity(clusters[i].centroid, clusters[j].centroid);

        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          mergeI = i;
          mergeJ = j;
          merged = true;
        }
      }
    }

    // Merge the most similar clusters
    if (merged && mergeI !== -1 && mergeJ !== -1) {
      const mergedQuestions = [...clusters[mergeI].questions, ...clusters[mergeJ].questions];
      const mergedCentroid = calculateCentroid(mergedQuestions.map((q) => q.embedding));

      clusters[mergeI] = {
        questions: mergedQuestions,
        centroid: mergedCentroid,
      };

      clusters.splice(mergeJ, 1);
    }
  }

  // Filter out clusters smaller than minimum size
  return clusters.filter((c) => c.questions.length >= MIN_CLUSTER_SIZE);
}

/**
 * Store clusters in the database
 */
export async function storeClusters(
  sessionId: string,
  clusters: Cluster[],
  clusterLabels: string[],
  representativeQuestions: string[]
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Delete existing clusters for this session
    await client.query('DELETE FROM question_clusters WHERE session_id = $1', [sessionId]);

    // Insert new clusters
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const label = clusterLabels[i] || `Cluster ${i + 1}`;
      const repQuestion = representativeQuestions[i] || cluster.questions[0].question_text;

      const result = await client.query(
        `INSERT INTO question_clusters (session_id, cluster_label, representative_question, question_count, centroid_embedding)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [sessionId, label, repQuestion, cluster.questions.length, JSON.stringify(cluster.centroid)]
      );

      const clusterId = result.rows[0].id;

      // Update questions with cluster_id
      for (const question of cluster.questions) {
        await client.query('UPDATE questions SET cluster_id = $1 WHERE id = $2', [
          clusterId,
          question.id,
        ]);
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
